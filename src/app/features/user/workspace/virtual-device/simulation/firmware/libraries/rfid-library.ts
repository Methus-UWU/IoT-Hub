import { FirmwareRuntimeError } from '../firmware-values';
import {
  libraryObject,
  libraryRecord,
  requirePin,
  type LibraryDefinition,
} from './library-support';
import { busReply } from './multi-pin-library';

export const RFID_LIBRARY: LibraryDefinition = {
  classes: {
    MFRC522: (args, host, line) => {
      const select = requirePin(host, args[0], 'MFRC522', line);
      const reset = requirePin(host, args[1], 'MFRC522', line);
      let initialized = false;
      let halted = false;
      let uid: number[] = [];
      const reply = () => {
        const message = busReply(host, { select, ...host.spiPins(), reset }, 'mfrc522');
        if (!message?.data['cardPresent']) halted = false;
        return message;
      };
      return libraryObject(
        'MFRC522',
        {
          PCD_Init: () => {
            initialized = true;
            halted = false;
            return 0;
          },
          PICC_IsNewCardPresent: () => initialized && !!reply()?.data['cardPresent'] && !halted,
          PICC_ReadCardSerial: () => {
            const message = reply();
            if (!initialized || !message?.data['cardPresent'] || halted) {
              uid = [];
              return false;
            }
            const raw = String(message.data['uid']).trim();
            if (!/^[0-9a-f]{2}( [0-9a-f]{2}){3}$/i.test(raw)) {
              uid = [];
              return false;
            }
            uid = raw.split(' ').map((byte) => parseInt(byte, 16));
            return true;
          },
          PICC_HaltA: () => {
            halted = true;
            return 0;
          },
          PCD_StopCrypto1: () => 0,
        },
        {
          read(field: string, readLine: number) {
            if (field !== 'uid')
              throw new FirmwareRuntimeError(`ไม่รองรับ MFRC522.${field}`, readLine);
            return libraryRecord('Uid', { size: uid.length, uidByte: [...uid], sak: 8 });
          },
        },
      );
    },
  },
};
