export const icTeamMembers = [
  { email: "jocy@iosg.vc", name: "Jocy" },
  { email: "yiping@iosg.vc", name: "Yiping" },
  { email: "frank@iosg.vc", name: "Frank" },
  { email: "mario@iosg.vc", name: "Mario" },
  { email: "jeffrey@iosg.vc", name: "Jeffrey" },
  { email: "turbo@iosg.vc", name: "Turbo" },
] as const;

export function isIosgIcTeamAvailable(workspaceDomain: string) {
  return workspaceDomain.trim().toLowerCase() === "iosg.vc";
}
