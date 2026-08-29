import { Component, computed, input, output, signal } from '@angular/core';

import { DashboardIcon } from './dashboard-icon';
import {
  DashboardWidget,
  WidgetAction,
  WidgetLayout,
  WidgetSettingChange,
} from './dashboard-builder.models';

export interface WidgetSelectRequest {
  widgetId: string;
  additive: boolean;
}

export interface WidgetPointerRequest {
  widgetId: string;
  event: PointerEvent;
}

export interface WidgetKeyboardLayoutRequest {
  widgetId: string;
  horizontal: number;
  vertical: number;
  resize: boolean;
}

@Component({
  selector: 'app-dashboard-widget',
  imports: [DashboardIcon],
  templateUrl: './dashboard-widget.html',
  styleUrl: './dashboard-widget.css',
})
export class DashboardWidgetComponent {
  readonly widget = input.required<DashboardWidget>();
  readonly layout = input.required<WidgetLayout>();
  readonly selected = input(false);
  readonly editMode = input(true);
  readonly moving = input(false);
  readonly invalid = input(false);

  readonly selectRequested = output<WidgetSelectRequest>();
  readonly moveStarted = output<WidgetPointerRequest>();
  readonly resizeStarted = output<WidgetPointerRequest>();
  readonly keyboardLayoutRequested = output<WidgetKeyboardLayoutRequest>();
  readonly actionRequested = output<WidgetAction>();
  readonly settingChanged = output<WidgetSettingChange>();

  protected readonly buttonHeld = signal(false);

  protected readonly displayValue = computed(() => {
    const value = this.widget().settings.controlValue;
    const decimals = Math.min(4, Math.max(0, Math.round(this.widget().settings.decimals)));
    return `${value.toFixed(decimals)}${this.widget().settings.unit}`;
  });

  protected readonly stateLabel = computed(() => {
    const state = this.widget().state;
    return state.slice(0, 1).toUpperCase() + state.slice(1);
  });

  private readonly clampedControl = computed(() =>
    Math.min(100, Math.max(0, this.widget().settings.controlValue)),
  );

  /** Length of the value arc on a 270° gauge normalised to pathLength=100. */
  protected readonly gaugeArc = computed(() => (this.clampedControl() * 0.75).toFixed(2));

  /** Filled portion of the slider track, as a percentage. */
  protected readonly rangeFill = computed(() => this.clampedControl());

  protected readonly positionLabel = computed(() => {
    const layout = this.layout();
    return `column ${layout.x + 1}, row ${layout.y + 1}, ${layout.cols} by ${layout.rows}`;
  });

  protected requestSelection(event: MouseEvent | PointerEvent): void {
    if (!this.editMode()) return;
    this.selectRequested.emit({
      widgetId: this.widget().id,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
    });
  }

  protected beginMove(event: PointerEvent): void {
    if (!this.editMode() || this.widget().settings.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.requestSelection(event);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.moveStarted.emit({ widgetId: this.widget().id, event });
  }

  protected beginResize(event: PointerEvent): void {
    if (!this.editMode() || this.widget().settings.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.requestSelection(event);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.resizeStarted.emit({ widgetId: this.widget().id, event });
  }

  protected handleHeaderKeydown(event: KeyboardEvent): void {
    if (!this.editMode() || this.widget().settings.locked) return;
    let horizontal = 0;
    let vertical = 0;
    if (event.key === 'ArrowLeft') horizontal = -1;
    else if (event.key === 'ArrowRight') horizontal = 1;
    else if (event.key === 'ArrowUp') vertical = -1;
    else if (event.key === 'ArrowDown') vertical = 1;
    else return;

    event.preventDefault();
    event.stopPropagation();
    this.keyboardLayoutRequested.emit({
      widgetId: this.widget().id,
      horizontal,
      vertical,
      resize: event.shiftKey,
    });
  }

  protected requestAction(action: WidgetAction['action'], event: MouseEvent): void {
    event.stopPropagation();
    this.requestSelection(event);
    this.actionRequested.emit({ widgetId: this.widget().id, action });
  }

  protected toggleSwitch(event: MouseEvent): void {
    event.stopPropagation();
    if (this.widget().state !== 'online') return;
    this.settingChanged.emit({
      widgetId: this.widget().id,
      controlValue: this.widget().settings.controlValue > 0 ? 0 : 1,
    });
  }

  protected updateRange(event: Event): void {
    this.settingChanged.emit({
      widgetId: this.widget().id,
      controlValue: Number((event.target as HTMLInputElement).value),
    });
  }

  protected stepNumeric(delta: number, event: MouseEvent): void {
    event.stopPropagation();
    if (this.widget().state !== 'online') return;
    const controlValue = Math.max(0, this.widget().settings.controlValue + delta);
    this.settingChanged.emit({ widgetId: this.widget().id, controlValue });
  }

  protected pressButton(event: Event): void {
    event.stopPropagation();
    if (this.widget().state !== 'online' || this.buttonHeld()) return;
    this.buttonHeld.set(true);
    this.settingChanged.emit({ widgetId: this.widget().id, controlValue: 1 });
  }

  protected releaseButton(): void {
    if (!this.buttonHeld()) return;
    this.buttonHeld.set(false);
    this.settingChanged.emit({ widgetId: this.widget().id, controlValue: 0 });
  }

  protected buttonKeydown(event: KeyboardEvent): void {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    this.pressButton(event);
  }

  protected buttonKeyup(event: KeyboardEvent): void {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    this.releaseButton();
  }
}
