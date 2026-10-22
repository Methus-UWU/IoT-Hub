import assert from 'node:assert/strict';
import type { DashboardWidget } from '../src/app/features/user/workspace/dashboard-builder/dashboard-builder.models';
import type { DeviceSnapshot } from '../src/app/features/user/workspace/dashboard-builder/devices-api.client';
import {
  applyLive,
  controlValue,
  seriesKeys,
} from '../src/app/features/user/workspace/dashboard-builder/live-overlay';

/**
 * Live dashboards without a browser: a widget bound to a datastream shows the device's
 * latest value, its state follows the device, and the saved widgets are never changed.
 */

let checks = 0;
function check(name: string, test: () => void): void {
  test();
  checks++;
  console.log(`PASS ${name}`);
}

function widget(id: string, type: DashboardWidget['type'], datasource: string): DashboardWidget {
  const layout = { x: 0, y: 0, cols: 3, rows: 3 };
  return {
    id,
    type,
    title: id,
    subtitle: '',
    deviceId: '',
    datasource,
    state: 'pending',
    layouts: { desktop: layout, tablet: layout, mobile: layout },
    settings: {
      accent: '#545454',
      background: 'white',
      showHeader: true,
      unit: '',
      decimals: 1,
      controlValue: 0,
      locked: false,
    },
  };
}

const widgets = [
  widget('gauge', 'gauge', 'temperature'),
  widget('relay', 'switch', 'relay'),
  widget('fan', 'slider', 'fan'),
  widget('label', 'text', ''),
  widget('history', 'line-chart', 'temperature'),
];

const snapshot = (online: boolean): DeviceSnapshot => ({
  deviceId: 'device',
  online,
  lastSeenAt: '2026-10-11T00:00:00Z',
  values: {
    temperature: { value: 24.5, source: 'device', updatedAt: '2026-10-11T00:00:00Z' },
    relay: { value: true, source: 'app', updatedAt: '2026-10-11T00:00:00Z' },
  },
});

check('bound widgets show the latest value and follow the device state', () => {
  const live = applyLive(widgets, snapshot(true));
  assert.equal(live[0].settings.controlValue, 24.5);
  assert.equal(live[0].state, 'online');
  assert.equal(live[1].settings.controlValue, 1);
  // A control with no value yet stays usable; an unbound widget is untouched.
  assert.equal(live[2].state, 'online');
  assert.equal(live[3], widgets[3]);

  const offline = applyLive(widgets, snapshot(false));
  assert.equal(offline[0].state, 'stale');
  assert.equal(offline[2].state, 'offline');
});

check('live values never touch the saved widgets', () => {
  applyLive(widgets, snapshot(true));
  assert.equal(widgets[0].settings.controlValue, 0);
  assert.equal(widgets[0].state, 'pending');
  assert.deepEqual(applyLive(widgets, null), widgets);
});

check('controls send the datastream type, and only charts ask for history', () => {
  assert.equal(controlValue('boolean', 1), true);
  assert.equal(controlValue('boolean', 0), false);
  assert.equal(controlValue('number', 42), 42);
  assert.equal(controlValue('string', 3), '3');
  assert.deepEqual(seriesKeys(widgets), ['temperature']);
});

console.log(`${checks}/${checks} live overlay checks passed`);
