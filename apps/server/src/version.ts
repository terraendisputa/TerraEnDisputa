declare const __APP_VERSION__: string;

export const APPLICATION_NAME = 'Terra en disputa';
export const APPLICATION_VERSION =
  typeof __APP_VERSION__ === 'undefined' ? 'development' : __APP_VERSION__;
