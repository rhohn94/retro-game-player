/* ==========================================================================
   Aura — Svelte bindings.

   Supported Svelte range: Svelte 4 and Svelte 5 (the default since the 5.0 GA
   in late 2024). Svelte renders custom elements natively; load the runtime once
   then use the tags:

     <script> import "@aura-design/core/dist/aura.js"; </script>

   EVENT HANDLING — pick the path for your Svelte major:

   • Svelte 5 (recommended). `on:` is deprecated for DOM events in favour of the
     property form (onclick); but Aura's COLON-named custom events (aura:change)
     are NOT expressible as `on*` properties, so the `use:events` action below is
     the CANONICAL path for them:

       <aura-button variant="primary" onclick={save}>Save</aura-button>
       <aura-editor name="body" use:events={{ "aura:change": e => html = e.detail.html }} />

   • Svelte 4 (legacy). The `on:` directive binds any DOM event, including the
     colon-named custom ones:

       <aura-button variant="primary" on:click={save}>Save</aura-button>
       <aura-editor name="body" on:aura:change={e => html = e.detail.html} />

   The `use:events` action works on both majors and is the single mechanism we
   recommend for Aura's custom events going forward. Types live in the generated
   aura-svelte.d.ts (#548), including a svelteHTML.IntrinsicElements attribute
   augmentation for every aura-* tag.
   ========================================================================== */

/* Svelte action: attach a map of { eventName: handler } to the node, updating
   listeners reactively and cleaning them up on destroy. */
export function events(node, map) {
  let current = map || {};
  function add(m) { for (const [name, fn] of Object.entries(m)) node.addEventListener(name, fn); }
  function remove(m) { for (const [name, fn] of Object.entries(m)) node.removeEventListener(name, fn); }
  add(current);
  return {
    update(next) { remove(current); current = next || {}; add(current); },
    destroy() { remove(current); },
  };
}

/* Re-export the tag list from the Svelte-LOCAL generated source (#660). The
   generator (tools/aura_react.py) emits a byte-identical aura-tags.generated.js
   into BOTH the vue and svelte binding dirs from one renderer, so this import is
   a sibling — the Svelte binding reaches into no other binding directory (#608)
   and vendoring only bindings/svelte/ works with no Vue adapter files present. */
export { AURA_TAGS } from "./aura-tags.generated.js";

/* Compiler predicate: any `aura-*` tag is a custom element. Owned locally so the
   Svelte adapter does not depend on the Vue binding's copy (#608). */
export function isAuraElement(tag) {
  return typeof tag === "string" && tag.startsWith("aura-");
}
