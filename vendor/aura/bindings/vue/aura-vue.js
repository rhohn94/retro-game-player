/* ==========================================================================
   Aura — Vue 3 bindings.

   Vue 3 already renders custom elements and binds their DOM events with @event,
   so the "binding" is mostly telling Vue's COMPILER not to treat `aura-*` tags
   as Vue components. That is a build-time option, not a runtime plugin.

   1) Tell the compiler aura-* are custom elements (vite.config.js):

        import vue from "@vitejs/plugin-vue";
        import { isAuraElement } from "@aura-design/core/bindings/vue";
        export default {
          plugins: [vue({ template: { compilerOptions: { isCustomElement: isAuraElement } } })],
        };

   2) Load the Aura runtime once (main.js):  import "@aura-design/core/dist/aura.js";

   3) Use the elements directly in templates — props are attributes, DOM events
      bind with @:

        <aura-button variant="primary" @click="save">Save</aura-button>
        <aura-editor name="body" @aura:change="onChange" />

   The Aura runtime registers the elements; Vue just renders + binds them.

   TypeScript: the generated aura-vue.d.ts (#548) types these exports AND
   augments the public `vue` module's GlobalComponents so every aura-* tag gets
   per-element attribute checking + IntelliSense in templates. (The #595 fix
   moved the augmentation off `@vue/runtime-core`, which vue-tsc never resolves,
   onto `vue` itself — see the d.ts header for the rationale.)
   ========================================================================== */

/* The public custom-element tag names Aura registers. GENERATED from the same
   element registry the React codegen validates against (#514): the list lives
   in aura-tags.generated.js (emitted by tools/aura_react.py) and is re-exported
   here, so it can never drift from the elements the runtime ships. The drift
   gate is `python3 tools/aura_react.py --check` (run inside `just check`). */
export { AURA_TAGS } from "./aura-tags.generated.js";
import { AURA_TAGS } from "./aura-tags.generated.js";

/* Compiler predicate: any `aura-*` tag is a custom element, not a Vue component.
   Use as compilerOptions.isCustomElement (see header). */
export function isAuraElement(tag) {
  return typeof tag === "string" && tag.startsWith("aura-");
}

/* Optional convenience plugin: registers nothing (the runtime does that), but
   exposes the tag list on the app for tooling/introspection. */
export default {
  install(app) {
    app.config.globalProperties.$auraTags = AURA_TAGS;
  },
};
