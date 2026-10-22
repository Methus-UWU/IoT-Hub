import { stringify, type LibraryObject } from '../firmware-values';
import { accept, libraryObject, type LibraryDefinition } from './library-support';

/**
 * Deterministic, sandboxed network surface for common ESP32 sketches.
 *
 * The browser simulator never opens a socket or sends credentials. WiFi reports
 * a virtual local connection so setup code can continue; HTTP calls explicitly
 * return the Arduino error value (-1) and an empty body.
 */
function wifi(): LibraryObject {
  let connected = false;
  return libraryObject('WiFiClass', {
    mode: accept,
    begin: () => {
      connected = true;
      return 3;
    },
    disconnect: () => {
      connected = false;
      return 0;
    },
    status: () => (connected ? 3 : 6),
    localIP: () => (connected ? '192.0.2.2' : '0.0.0.0'),
    RSSI: () => (connected ? -42 : 0),
    macAddress: () => '02:00:00:00:00:01',
    hostname: () => 'iot-hub-simulator',
  });
}

function httpClient(): LibraryObject {
  let url = '';
  return libraryObject('HTTPClient', {
    begin: (args) => {
      url = stringify(args.at(-1));
      return url ? 1 : 0;
    },
    addHeader: accept,
    setTimeout: accept,
    GET: () => -1,
    POST: () => -1,
    PUT: () => -1,
    PATCH: () => -1,
    getString: () => '',
    errorToString: () => 'network disabled in browser simulator',
    end: () => {
      url = '';
      return 0;
    },
  });
}

const networkClient = () => libraryObject('WiFiClient', {
  connect: () => 0,
  connected: () => 0,
  available: () => 0,
  read: () => -1,
  print: () => 0,
  println: () => 0,
  stop: accept,
  setInsecure: accept,
});

export const NETWORK_LIBRARY: LibraryDefinition = {
  classes: {
    HTTPClient: () => httpClient(),
    WiFiClient: networkClient,
    WiFiClientSecure: networkClient,
  },
  globals: { WiFi: () => wifi() },
  constants: {
    WL_CONNECTED: 3,
    WL_DISCONNECTED: 6,
    WIFI_STA: 1,
    WIFI_AP: 2,
    WIFI_AP_STA: 3,
    HTTP_CODE_OK: 200,
  },
};
