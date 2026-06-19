import type { ComponentType } from "react";

import type { PageDefinition, PageId, PageRuntime } from "@/pages/page.types";

const pageComponentCache = new Map<PageId, ComponentType<PageRuntime>>();
const pageComponentPromises = new Map<
  PageId,
  Promise<ComponentType<PageRuntime>>
>();
const pagePreloadPromises = new Map<PageId, Promise<unknown>>();

export function getCachedPageComponent(page: PageDefinition) {
  return pageComponentCache.get(page.id) ?? null;
}

export function loadPageComponent(page: PageDefinition) {
  const cachedComponent = getCachedPageComponent(page);
  if (cachedComponent) {
    return Promise.resolve(cachedComponent);
  }

  const existingPromise = pageComponentPromises.get(page.id);
  if (existingPromise) {
    return existingPromise;
  }

  const componentPromise = page
    .loadComponent()
    .then((module) => {
      pageComponentCache.set(page.id, module.default);
      return module.default;
    })
    .catch((error: unknown) => {
      pageComponentPromises.delete(page.id);
      throw error;
    });

  pageComponentPromises.set(page.id, componentPromise);
  return componentPromise;
}

export function preloadPageRuntime(page: PageDefinition) {
  if (!page.preload) {
    return Promise.resolve();
  }

  const existingPromise = pagePreloadPromises.get(page.id);
  if (existingPromise) {
    return existingPromise;
  }

  const preloadPromise = Promise.resolve(page.preload()).catch(
    (error: unknown) => {
      pagePreloadPromises.delete(page.id);
      throw error;
    },
  );

  pagePreloadPromises.set(page.id, preloadPromise);
  return preloadPromise;
}

export function preloadPageComponent(page: PageDefinition) {
  void loadPageComponent(page).catch(() => undefined);
}
