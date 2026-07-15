import { describe, expect, it } from "vitest";
import type { ConsoleInfo } from "../../ipc/console";
import {
  consoleComposeValue,
  consoleDropdownLabel,
  consoleRankTokenBag,
} from "./consoleSearch";

function console(partial: Partial<ConsoleInfo> & Pick<ConsoleInfo, "key" | "name" | "abbreviation">): ConsoleInfo {
  return {
    manufacturer: "Test",
    generation: 4,
    year: 1990,
    cpu: "",
    gpu: "",
    ram: "",
    description: null,
    wikipediaUrl: null,
    imagePath: null,
    ownedCount: 0,
    catalogCount: 0,
    ...partial,
  };
}

describe("consoleDropdownLabel", () => {
  it("shows Genesis / Mega Drive with MD tag instead of bare MD", () => {
    const label = consoleDropdownLabel(
      console({
        key: "genesis",
        name: "Sega Genesis / Mega Drive",
        abbreviation: "MD",
      })
    );
    expect(label).toMatch(/Genesis/i);
    expect(label).toMatch(/Mega Drive/i);
    expect(label).toMatch(/MD/);
  });

  it("labels NES with Famicom dual name", () => {
    const label = consoleDropdownLabel(
      console({
        key: "nes",
        name: "Nintendo Entertainment System",
        abbreviation: "NES",
      })
    );
    expect(label).toMatch(/Famicom/i);
  });
});

describe("consoleRankTokenBag", () => {
  it("includes genesis, mega drive, md, and smd for MD console", () => {
    const bag = consoleRankTokenBag(
      console({
        key: "genesis",
        name: "Sega Genesis / Mega Drive",
        abbreviation: "MD",
      })
    ).toLowerCase();
    expect(bag).toContain("genesis");
    expect(bag).toContain("mega drive");
    expect(bag).toContain("md");
    expect(bag).toContain("smd");
  });
});

describe("consoleComposeValue", () => {
  it("sends the system key for backend alias expansion", () => {
    expect(
      consoleComposeValue(
        console({
          key: "genesis",
          name: "Sega Genesis / Mega Drive",
          abbreviation: "MD",
        })
      )
    ).toBe("genesis");
  });
});
