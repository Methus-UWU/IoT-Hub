import { Pipe, PipeTransform, SecurityContext, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';

/**
 * Renders assistant messages as HTML.
 *
 * Model output is untrusted input: a prompt-injected or malicious response can
 * contain markup, and `marked` passes raw HTML through untouched. The result is
 * therefore sanitized explicitly here and returned as a plain string, so the
 * value is sanitized once by this pipe and again by Angular's `[innerHTML]`
 * binding. Returning `SafeHtml` would disable the second pass, so it must not be
 * introduced, and no `bypassSecurityTrust*` call belongs anywhere near this pipe.
 */
@Pipe({
  name: 'markdown',
})
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string): string {
    const rendered = marked(value, {
      async: false,
      breaks: true,
      gfm: true,
    });

    return this.sanitizer.sanitize(SecurityContext.HTML, rendered) ?? '';
  }
}
