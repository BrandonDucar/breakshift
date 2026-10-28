# Licensing And Submission Boundary

Brandon selected Apache-2.0 for the hackathon entry's original code on October 27,
2026, matching the existing DreamNet repository license. LICENSE contains that
license and NOTICE identifies the project. Existing third-party licenses remain
unchanged. This document does not change the license of unrelated DreamNet code.

## Assets And Services

- The two original generated fictional-machine illustrations have source prompts
  and provenance in ASSET_PROVENANCE.md. They are illustrations, not photographs,
  certified plans or physical inspection evidence. Do not assert exclusive
  copyright or ownership of third-party material merely because AI generated it.
- User-uploaded images, private tester material, credentials, receipts containing
  private data and correspondence are not public submission assets or permissions
  to reuse them. Keep them out of GitHub and distributable bundles.
- Meta API/model access remains subject to the provider's own terms. This source
  license does not distribute or license model weights, service access or brands.
- Node.js, Cloudflare tooling, browsers and other external executables retain
  their own terms. Do not bundle their binaries based on this project license.

## Public Submission Checklist

Public visibility and open-source licensing are separate choices. The organizer
text supplied by Brandon requires a public repository but did not name a code
license. The public event-details page did not expose complete rules during this
review; confirm the accepted official rules before final submission.

Only event-authored project code and approved assets should enter the submission,
with third-party components identified rather than claimed as new contributions.
Keep LICENSE, NOTICE, attribution and the new-work manifest in the standalone
submission repository. Recheck dependency notices if combining this workcell with
Change Witness, whose THIRD_PARTY_NOTICES.md and licenses/ inventory cover its
separate npm/frontend/skill dependencies.

The deployed Cloudflare URL is not evidence of a public GitHub repository. This
review found this workcell untracked in DreamNet and no matching submission repo
in the first 100 repositories returned for BrandonDucar. That is a release gap,
not proof that no repository exists elsewhere. Do not publish the whole dirty
monorepo to resolve it. Review an explicit file allowlist and secret scan first.

Historical repair ZIPs and the existing hosted deployment were not repackaged or
redeployed by this licensing update; ensure notices accompany the final artifact.
