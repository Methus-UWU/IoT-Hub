import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { UsageMetric } from '../../features/user/projects/plan-usage-card';

interface RemoteUsageMetric {
  key: string;
  label: string;
  used: number;
  limit: number;
  unlimited: boolean;
  percent: number;
  unit?: string;
}

interface RemoteUsageReport {
  plan: { code: string; name: string };
  metrics: RemoteUsageMetric[];
}

/**
 * Plan usage for the signed-in user.
 *
 * Every number here comes from the API. The panel previously rendered fixed
 * strings — 1,240 AI credits, 84 MB, 3 of 5 projects — for every account,
 * including brand-new ones that owned nothing.
 */
@Service()
export class UsageApiService {
  private readonly http = inject(HttpClient);

  async load(): Promise<UsageMetric[]> {
    const report = await firstValueFrom(
      this.http.get<RemoteUsageReport>(`${environment.apiUrl}me/usage`),
    );

    return report.metrics.map((metric) => ({
      label: metric.label,
      value: formatValue(metric.used, metric.unit),
      limit: metric.unlimited
        ? 'Unlimited'
        : formatValue(metric.limit, metric.unit),
      percent: metric.percent,
    }));
  }
}

function formatValue(value: number, unit?: string): string {
  // Storage is reported with one decimal; counts are whole numbers.
  const rendered =
    Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
  return unit ? `${rendered} ${unit}` : rendered;
}
