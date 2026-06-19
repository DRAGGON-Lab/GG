/// <reference types="vite/client" />

declare global {
  var MonacoEnvironment:
    | {
        getWorker: () => Worker;
      }
    | undefined;
}

export {};
