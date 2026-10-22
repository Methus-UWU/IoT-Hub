import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

import { CustomSelect } from '../../../../../shared/components/custom-select/custom-select';
import type { DevicePropertyDefinition } from '../devices/core/device-definition';
import type { VirtualDevice } from '../models/virtual-device.model';
import { SEVERITY_LABELS, type WireIssue } from '../simulation/wire-validation';

type PropertyValue = string | number | boolean;

export interface InspectorReading {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly description?: string;
}

export interface PropertyChange {
  readonly id: string;
  readonly value: PropertyValue;
}

type Control = 'segmented' | 'swatches' | 'dropdown' | 'switch' | 'slider' | 'number' | 'text';

interface Field {
  readonly property: DevicePropertyDefinition;
  readonly control: Control;
}

/** Colour values (LEDs, button caps), drawn as swatches because a colour is quicker seen than read. */
const SWATCHES: Readonly<Record<string, string>> = {
  silver: '#cbd5e1',
  red: '#ef4444',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#facc15',
  white: '#f8fafc',
  orange: '#f97316',
};

/** A select this small reads faster as one row of buttons than behind a dropdown. */
const MAX_SEGMENTS = 4;
const MAX_SEGMENT_LABEL = 10;

function controlFor(property: DevicePropertyDefinition): Control {
  switch (property.kind) {
    case 'boolean':
      return 'switch';
    case 'number':
      return property.min !== undefined && property.max !== undefined ? 'slider' : 'number';
    case 'select': {
      const options = property.options ?? [];
      if (options.length && options.every((option) => SWATCHES[option.value])) return 'swatches';
      if (
        options.length <= MAX_SEGMENTS &&
        options.every((option) => option.label.length <= MAX_SEGMENT_LABEL)
      ) {
        return 'segmented';
      }
      return 'dropdown';
    }
    default:
      return 'text';
  }
}

/** Controls that only mean something while the circuit is running. */
function isLive(property: DevicePropertyDefinition): boolean {
  return property.group === 'simulation' || Boolean(property.simulationOnly);
}

/**
 * Settings panel for the selected part.
 *
 * Built from the part's definition, so a new part gets its controls without any
 * markup here. Two rules keep it short. Each setting uses the smallest control
 * that fits it — a row of buttons for LOW/HIGH or 3/5/12 V, swatches for a
 * colour, a switch for on/off, the shared custom select only for long option
 * lists — and the part's settings are kept apart from the
 * controls that only act while the simulation runs.
 */
@Component({
  selector: 'app-device-inspector',
  imports: [CustomSelect, NgTemplateOutlet],
  templateUrl: './device-inspector.html',
  styleUrl: './device-inspector.css',
})
export class DeviceInspector {
  readonly device = input.required<VirtualDevice & { readonly instanceId: string }>();
  readonly state = input<Readonly<Record<string, PropertyValue>>>({});
  readonly readings = input<readonly InspectorReading[]>([]);
  readonly issues = input<readonly WireIssue[]>([]);
  readonly running = input(false);

  readonly propertyChange = output<PropertyChange>();
  readonly reset = output<void>();
  readonly variantChange = output<string>();
  readonly rotate = output<void>();
  readonly remove = output<void>();
  readonly closed = output<void>();
  readonly revealIssue = output<WireIssue>();
  readonly dismissIssue = output<string>();

  protected readonly severityLabels = SEVERITY_LABELS;
  protected readonly swatches = SWATCHES;

  private readonly fields = computed<readonly Field[]>(() =>
    (this.device().properties ?? []).map((property) => ({
      property,
      control: controlFor(property),
    })),
  );

  protected readonly settingFields = computed(() =>
    this.fields().filter((field) => !isLive(field.property)),
  );
  protected readonly liveFields = computed(() =>
    this.fields().filter((field) => isLive(field.property)),
  );

  protected value(property: DevicePropertyDefinition): PropertyValue {
    return this.state()[property.id] ?? property.defaultValue;
  }

  protected text(property: DevicePropertyDefinition): string {
    return String(this.value(property));
  }

  protected number(property: DevicePropertyDefinition): number {
    const value = this.value(property);
    return typeof value === 'number' ? value : Number(value) || 0;
  }

  protected checked(property: DevicePropertyDefinition): boolean {
    return this.value(property) === true;
  }

  protected optionLabel(property: DevicePropertyDefinition): string {
    const value = this.text(property);
    return property.options?.find((option) => option.value === value)?.label ?? value;
  }

  /** Live controls stay inert until the simulation runs. */
  protected disabled(property: DevicePropertyDefinition): boolean {
    return !this.running() && isLive(property);
  }

  protected fieldId(property: DevicePropertyDefinition): string {
    return `inspector-${this.device().instanceId}-${property.id}`;
  }

  protected numberFieldId(property: DevicePropertyDefinition): string {
    return `${this.fieldId(property)}-number`;
  }

  protected rangeProgress(property: DevicePropertyDefinition): string {
    const min = property.min ?? 0;
    const max = property.max ?? 100;
    if (max <= min) return '0%';
    const percent = ((this.number(property) - min) / (max - min)) * 100;
    return `${Math.min(100, Math.max(0, percent))}%`;
  }

  protected choose(property: DevicePropertyDefinition, value: string): void {
    this.propertyChange.emit({ id: property.id, value });
  }

  protected toggle(property: DevicePropertyDefinition, event: Event): void {
    this.propertyChange.emit({
      id: property.id,
      value: (event.target as HTMLInputElement).checked,
    });
  }

  protected setNumber(property: DevicePropertyDefinition, event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.valueAsNumber;
    if (!Number.isFinite(raw)) {
      input.value = String(this.number(property));
      return;
    }

    let value = Math.min(
      property.max ?? Number.POSITIVE_INFINITY,
      Math.max(property.min ?? Number.NEGATIVE_INFINITY, raw),
    );

    const step = property.step;
    if (step !== undefined && step > 0) {
      const base = property.min ?? 0;
      value = base + Math.round((value - base) / step) * step;
      value = Number(value.toPrecision(12));
      value = Math.min(
        property.max ?? Number.POSITIVE_INFINITY,
        Math.max(property.min ?? Number.NEGATIVE_INFINITY, value),
      );
    }

    input.value = String(value);
    this.propertyChange.emit({ id: property.id, value });
  }

  protected setText(property: DevicePropertyDefinition, event: Event): void {
    this.propertyChange.emit({ id: property.id, value: (event.target as HTMLInputElement).value });
  }
}
