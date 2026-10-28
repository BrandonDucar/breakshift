// Recognize the complete bounded command, not a keyword embedded in other prose.
const recipe = String.raw`(?:(?:run|evaluate|test) )?(?:power[ -]only(?: fix)?|surge[ -]interleave|stagger surge|interleave only|timing[ -]only(?: fix)?|timing fix|timing compensation|delay sensor / timing fix|coordinated(?: repair)?|full repair|recover orders|recover line|bypass station a|handoff to (?:station )?b|reroute to (?:station )?b|jam station a|disable gripper|sabotage station a|faulted line|unrepaired|station handoff baseline)`;
const limit = String.raw`(?:(?:(?:set|drop|lower|raise|restore|reset) )?(?:breaker|cap|ceiling|brownout|limit)\s*(?:(?:to|at|=|:)\s*)?-?\d+(?:\.\d{1,3})?\s*kw|-?\d+(?:\.\d{1,3})?\s*kw|brownout|cut power|drop power|stress cap|tighter cap|(?:restore|reset|nominal)(?: (?:breaker|cap|power))?)`;
const focus = String.raw`(?:(?:inspect|focus|select) )?(?:48\s*v(?: cabinet)?|cabinet|busbar|main bus|panel p1|optical(?: gate| lag)?|gate|junction j2|encoder|photoeye|station [ab]|arm [ab]|pinch gripper|solenoid head)`;
const view = String.raw`(?:top bus|overhead cam|bird'?s[ -]eye|wrist cam|zoom arm|focus wrist|iso cam|reset cam|isometric|spatial|3d stage|3d view|cutaway|peel exterior|look inside(?: cutaway)?|schematic|wiring diagram|workcell map|overview map)`;
const single = new RegExp(`^(?:${recipe}|${limit}|${focus}|${view})$`, 'i');
const compound = new RegExp(`^(?:${limit}) and (?:${recipe})$`, 'i');
export function completeSabotageCommand(text) { return typeof text === 'string' && (single.test(text) || compound.test(text)); }
