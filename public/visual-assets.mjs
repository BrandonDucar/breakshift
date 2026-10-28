// The bay, reference plates and repair player share these original approved assets.
// Inspection pixels and the hash-bound SAM demo are separate evidence, never reskinned.
export const BAY_ART = Object.freeze({
  workcell: Object.freeze({src:'/public/assets/breakshift-microgrid-hero-v1.png', alt:'Original concept illustration of the fictional two-robot microgrid workcell'}),
  cutaway: Object.freeze({src:'/public/assets/robot-cutaway-v1.png', alt:'Original fictional Station A cutaway with ceramic shell, copper motor coils and exposed gripper internals'})
});
export function referencePlate(kind, caption) {
  const art = BAY_ART[kind];
  return `<figure class="bay-reference"><img src="${art.src}" alt="${art.alt}" width="1774" height="887"><figcaption><span>ILLUSTRATED BAY REFERENCE</span><strong>${caption}</strong><small>Concept assembly · not camera evidence or calibrated CAD</small></figcaption><p class="bay-art-unavailable" hidden>Reference illustration unavailable. Component labels and evidence remain available.</p></figure>`;
}
export function bindReferenceFallback(root) {
  root.querySelectorAll('.bay-reference img').forEach(img => {
    const failed = () => { img.hidden = true; img.closest('.bay-reference').querySelector('.bay-art-unavailable').hidden = false; };
    img.addEventListener('error', failed, {once:true});
    if (img.complete && !img.naturalWidth) failed();
  });
}
