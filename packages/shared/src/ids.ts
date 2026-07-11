import { customAlphabet } from "nanoid";

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  21,
);

export const ID_PREFIXES = {
  org: "org_",
  ws: "ws_",
  user: "user_",
  mbr: "mbr_",
  agent: "agent_",
  key: "key_",
  pol: "pol_",
  ch: "ch_",
  req: "req_",
  evt: "evt_",
  asg: "asg_",
  ntf: "ntf_",
  del: "del_",
} as const;

export type IdEntity = keyof typeof ID_PREFIXES;

export function generateId(entity: IdEntity): string {
  return `${ID_PREFIXES[entity]}${nanoid()}`;
}

export function isPrefixedId(value: string, entity: IdEntity): boolean {
  return value.startsWith(ID_PREFIXES[entity]);
}

export function parseIdPrefix(value: string): IdEntity | null {
  for (const [entity, prefix] of Object.entries(ID_PREFIXES)) {
    if (value.startsWith(prefix)) {
      return entity as IdEntity;
    }
  }
  return null;
}
