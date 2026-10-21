import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { INVITE_PERMISSION_BITS } from "../../web/lib/invite.ts";
import auditlog from "@tier0/module-auditlog";
import automod from "@tier0/module-automod";
import feeds from "@tier0/module-feeds";
import gaming from "@tier0/module-gaming";
import leveling from "@tier0/module-leveling";
import moderation from "@tier0/module-moderation";
import roles from "@tier0/module-roles";
import automations from "@tier0/module-automations";
import customcommands from "@tier0/module-customcommands";
import sticky from "@tier0/module-sticky";
import serverlog from "@tier0/module-serverlog";
import system from "@tier0/module-system";
import tickets from "@tier0/module-tickets";
import utility from "@tier0/module-utility";
import verification from "@tier0/module-verification";
import welcome from "@tier0/module-welcome";

/**
 * The invite link is what most servers add the bot with, so a feature whose
 * permission it leaves out works nowhere until the owner finds the gap and adds
 * the permission by hand. Each module says what it needs in `requires`, and this
 * holds the link to it.
 */
const modules = [auditlog, automations, customcommands, sticky, sticky, automod, feeds, gaming, leveling, moderation, roles, serverlog, system, tickets, utility, verification, welcome];

describe("the invite link", () => {
  test("asks for every permission a module says it needs", () => {
    const asked = new Set(Object.keys(INVITE_PERMISSION_BITS));
    for (const module of modules) {
      for (const needed of module.requires ?? []) {
        assert.ok(asked.has(needed), `${module.id} needs ${needed}, which the invite link does not ask for`);
      }
    }
  });
});
