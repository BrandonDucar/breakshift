import { sha256Hex } from '../session/inspection-session-core.mjs';
const need=(v,c)=>{if(!v)throw Error(c);};
export function validateRobotCatalog(catalog) {
  need(catalog?.schema==='dreamnet.app-robot-catalog.v1'&&catalog.appId==='breakshift'&&catalog.tenantId==='dreamnet'&&catalog.authorityGranted===false,'ROBOT_CATALOG_SCOPE_INVALID');
  need(Array.isArray(catalog.profiles)&&catalog.profiles.length>0&&catalog.profiles.length<=100,'ROBOT_CATALOG_SIZE_INVALID');
  const ids=new Set();
  for(const p of catalog.profiles){
    need(/^[a-z0-9-]{1,80}$/.test(p.assetId)&&/^\d+\.\d+\.\d+$/.test(p.version)&&!ids.has(p.assetId),'ROBOT_PROFILE_VERSION_INVALID');ids.add(p.assetId);
    need(typeof p.label==='string'&&p.label.length<=160&&p.source&&new URL(p.source.url).protocol==='https:'&&p.physicalClearance===false,'ROBOT_PROFILE_SOURCE_INVALID');
    need(Array.isArray(p.missingBindings)&&p.source.license&&p.source.rightsScope,'ROBOT_PROFILE_RIGHTS_REQUIRED');
    need(p.qualification==='UNQUALIFIED_REFERENCE_ONLY'&&p.adapter===null||p.assetId==='breakshift-reference-cell'&&p.kind==='SYNTHETIC_WORKCELL'&&p.qualification==='SIMULATOR_FIXTURE_ONLY'&&p.adapter==='breakshift-uncertainty-energy/1','ROBOT_ADAPTER_UNQUALIFIED');
  }
  return structuredClone(catalog);
}
export function assetBinding(profile){return {assetId:profile.assetId,version:profile.version,profileDigest:sha256Hex(profile),qualification:profile.qualification};}
