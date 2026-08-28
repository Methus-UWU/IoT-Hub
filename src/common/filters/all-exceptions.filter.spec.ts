import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  AllExceptionsFilter,
  type ApiErrorBody,
} from './all-exceptions.filter';

function hostFor(requestId = 'req-1234567890'): {
  host: ArgumentsHost;
  sent: { status?: number; body?: ApiErrorBody };
} {
  const sent: { status?: number; body?: ApiErrorBody } = {};
  interface ResponseStub {
    status(code: number): ResponseStub;
    json(body: ApiErrorBody): ResponseStub;
  }
  const response: ResponseStub = {
    status: (code: number) => {
      sent.status = code;
      return response;
    },
    json: (body: ApiErrorBody) => {
      sent.body = body;
      return response;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ requestId }),
    }),
  } as unknown as ArgumentsHost;

  return { host, sent };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    // The filter logs the underlying failure by design; keep the suite output clean.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('maps an HttpException to a stable code and keeps the request id', () => {
    const { host, sent } = hostFor('req-abcdefgh');

    filter.catch(new ConflictException('Username already exists'), host);

    expect(sent.status).toBe(HttpStatus.CONFLICT);
    expect(sent.body?.error).toMatchObject({
      code: 'CONFLICT',
      message: 'Username already exists',
      requestId: 'req-abcdefgh',
    });
  });

  it('returns validation constraint messages as details', () => {
    const { host, sent } = hostFor();

    filter.catch(
      new BadRequestException({ message: ['email must be an email'] }),
      host,
    );

    expect(sent.body?.error.details).toEqual(['email must be an email']);
  });

  it('honours an explicit domain error code', () => {
    const { host, sent } = hostFor();

    filter.catch(
      new ConflictException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      }),
      host,
    );

    expect(sent.body?.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('forwards domain context such as a limit and its usage', () => {
    const { host, sent } = hostFor();

    filter.catch(
      new ConflictException({
        code: 'PROJECT_LIMIT_REACHED',
        message: 'Your Free plan supports up to 5 projects.',
        limit: 5,
        used: 5,
        planCode: 'free',
      }),
      host,
    );

    expect(sent.body?.error).toMatchObject({
      code: 'PROJECT_LIMIT_REACHED',
      limit: 5,
      used: 5,
      planCode: 'free',
    });
  });

  it('does not forward context from a server error', () => {
    process.env.NODE_ENV = 'production';
    const { host, sent } = hostFor();

    filter.catch(
      new InternalServerErrorException({
        code: 'SUBSCRIPTION_MISSING',
        message: 'internal detail',
        internalHint: 'do not leak me',
      }),
      host,
    );

    expect(JSON.stringify(sent.body)).not.toContain('do not leak me');
    expect(sent.body?.error.message).toBe('An unexpected error occurred');
  });

  it('never leaks an unexpected failure to a production client', () => {
    process.env.NODE_ENV = 'production';
    const { host, sent } = hostFor();
    const leaky = new Error(
      'connect ECONNREFUSED 10.0.0.5:5432 postgresql://postgres:hunter2@db/iot_hub',
    );

    filter.catch(leaky, host);

    expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(sent.body?.error.code).toBe('INTERNAL_ERROR');
    expect(sent.body?.error.message).toBe('An unexpected error occurred');
    expect(sent.body?.error.debug).toBeUndefined();
    expect(JSON.stringify(sent.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(sent.body)).not.toContain('postgresql://');
  });

  it('never leaks a stack trace', () => {
    process.env.NODE_ENV = 'production';
    const { host, sent } = hostFor();

    filter.catch(new TypeError('cannot read properties of undefined'), host);

    expect(JSON.stringify(sent.body)).not.toContain('at ');
  });
});
