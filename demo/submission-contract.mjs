import assert from 'node:assert/strict';

export const PENDING_SUBMISSION_GATES=Object.freeze([
  'FINAL_INDEPENDENT_EXACT_BYTE_REVIEW',
  'SIGNED_OUT_LINK_CHECKS',
  'OWNER_CONFIRM_HUMAN_CONTRIBUTORS_AND_TRACK',
  'VERIFY_ACCEPTED_RULES_AND_SUBMISSION_FORM',
  'OWNER_DECIDE_SOURCE_AND_RELEASE_PROMOTION',
  'OWNER_APPROVE_EXACT_ORGANIZER_ENTRY',
]);

// This checks the dated preparation snapshot, not current permission or readiness.
export function assertSubmissionSnapshot(packet,binding,story){
  assert.equal(packet.schema,'breakshift.submission-readiness.v1');
  assert.equal(packet.version,'1.0.0');
  assert.equal(packet.asOfDate,'2026-10-31');
  assert.equal(packet.status,'HOSTED_DEMO_FINAL_REVIEW_PENDING_NOT_SUBMITTED');
  assert.equal(packet.snapshotOnly,true);
  assert.equal(packet.demo.sha256,binding.outputSha256);
  assert.ok(packet.demo.durationSeconds>=story.durationSeconds && packet.demo.durationSeconds<180);
  for(const key of ['ownerVideoApproved','ownerUnlistedUploadApproved','uploadCompleted','authenticatedPlaybackVerified'])
    assert.equal(packet.demo[key],true,key);
  assert.equal(packet.demo.signedOutPlaybackVerified,false);
  assert.equal(packet.demo.visibility,'UNLISTED');
  assert.equal(packet.demo.linkDisclosure,'PRIVATE_OWNER_SUBMISSION_HANDOFF_ONLY');
  assert.equal(packet.release.copyPolishDeployed,false);
  assert.equal(packet.release.reviewPullRequestMerged,false);
  const authorityKeys=['organizerSubmitted','mergeApprovedByThisSnapshot','deployApprovedByThisSnapshot','submissionApprovedByThisSnapshot','physicalRepairClearance'];
  assert.deepEqual(Object.keys(packet.authority).sort(),authorityKeys.toSorted());
  for(const key of authorityKeys)assert.equal(packet.authority[key],false,key);
  assert.deepEqual(packet.remainingGates,PENDING_SUBMISSION_GATES);
  assert.equal(packet.organizerOverview.fullAcceptedRulesVerified,false);
  assert.equal(packet.organizerOverview.submissionFormVerified,false);
}

export function assertNoPublicVideoLink(text){
  assert.doesNotMatch(text,/\b(?:[\w-]+\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\b/i);
}
