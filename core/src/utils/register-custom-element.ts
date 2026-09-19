export function registerCustomElement(tag: string, constructor: CustomElementConstructor) {
  if (globalThis.customElements && !globalThis.customElements.get(tag)) {
    globalThis.customElements.define(tag, constructor);
  }
}
