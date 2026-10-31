// SPDX-License-Identifier: AGPL-3.0-or-later
// The import dialog's body map: the parts of the body a piece can be dropped on, and the places
// (placement/places.ts) they stand for. A zone is only a position the person picks: nothing here
// reads the piece's shape or looks at seams (packages/vitryne-docs/content/docs/developers/patents.md,
// rule 3).

import { PAIRS, PLACES, type Pair, type Place } from "@/placement/places";

export type View = "front" | "back";
export type Zone =
  "torso" | "arm-right" | "arm-left" | "leg-right" | "leg-left";

/** A zone's box in a view's 200 × 340 drawing; the wearer's right is on the image's left in the front view. */
export interface ZoneBox {
  zone: Zone;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
}

const ARM = { y: 58, w: 24, h: 148, rx: 11 };
const LEG = { y: 168, w: 30, h: 160, rx: 12 };

/** The zones of one view, mirrored for the back (the wearer's right is then on the image's right). */
export function zonesIn(view: View): ZoneBox[] {
  const x = (left: number, w: number, right: boolean) =>
    right === (view === "front") ? left : 200 - left - w;
  return [
    { zone: "torso", label: "Torso", x: 66, y: 57, w: 68, h: 108, rx: 12 },
    {
      zone: "arm-right",
      label: "Right arm",
      ...ARM,
      x: x(38, ARM.w, true),
    },
    { zone: "arm-left", label: "Left arm", ...ARM, x: x(38, ARM.w, false) },
    { zone: "leg-right", label: "Right leg", ...LEG, x: x(68, LEG.w, true) },
    { zone: "leg-left", label: "Left leg", ...LEG, x: x(68, LEG.w, false) },
  ];
}

export const zoneKey = (view: View, zone: Zone) => `${view}:${zone}`;

/** Where on an arm or a leg a piece's top edge can start (Rust `placement::Landmark`). */
export type Landmark = "upper-arm" | "forearm" | "wrist" | "knee" | "ankle";

/**
 * The finer places of a limb, top to bottom, as parts of its zone's height. `landmark` null: the
 * limb's usual start (the shoulder, the waist).
 */
export const LANDMARKS: Partial<
  Record<Zone, { landmark: Landmark | null; label: string; share: number }[]>
> = {
  "arm-right": [
    { landmark: null, label: "Shoulder", share: 0.2 },
    { landmark: "upper-arm", label: "Upper arm", share: 0.25 },
    { landmark: "forearm", label: "Forearm", share: 0.3 },
    { landmark: "wrist", label: "Wrist", share: 0.25 },
  ],
  "leg-right": [
    { landmark: null, label: "Thigh", share: 0.45 },
    { landmark: "knee", label: "Knee", share: 0.3 },
    { landmark: "ankle", label: "Ankle", share: 0.25 },
  ],
};
LANDMARKS["arm-left"] = LANDMARKS["arm-right"];
LANDMARKS["leg-left"] = LANDMARKS["leg-right"];

/** A zone key's view and zone, and the finer place if it has one (`front:arm-left#wrist`). */
export function parseZoneKey(key: string): [View, Zone, Landmark | null] {
  const [base = "", landmark] = key.split("#");
  const [view, zone] = base.split(":");
  return [view as View, zone as Zone, (landmark as Landmark) || null];
}

/**
 * The import choice for a piece dropped on a zone: a pair of arms or legs when the piece is cut
 * twice, else one place. Null when the zone can't take it (a pair of pieces on the torso).
 */
export function choiceAt(view: View, zone: Zone, pair: boolean): string | null {
  const side = view === "front" ? "front" : "back";
  switch (zone) {
    case "torso":
      return pair ? null : `one:body-${side}`;
    case "arm-right":
    case "arm-left":
      return pair ? "pair:arms" : `one:${zone}`;
    case "leg-right":
    case "leg-left":
      return pair ? `pair:legs-${side}` : `one:${zone}-${side}`;
  }
}

/** The zone keys an encoded choice (`one:…`, `pair:…`) sits on; none for the others. */
export function zonesOf(choice: string | null | undefined): string[] {
  if (!choice) return [];
  const places: Place[] = choice.startsWith("one:")
    ? [choice.slice(4) as Place]
    : choice.startsWith("pair:")
      ? [...(PAIRS[choice.slice(5) as Pair]?.places ?? [])]
      : [];
  return places.flatMap((p) => {
    const spec = PLACES[p];
    if (!spec) return [];
    const { region, angle } = spec;
    const side = angle === 0 ? "front" : angle === Math.PI ? "back" : null;
    if (region === "torso") {
      return side ? [zoneKey(side, "torso")] : [];
    }
    if (region === "arm-right" || region === "arm-left") {
      return [zoneKey("front", region), zoneKey("back", region)];
    }
    if (region === "leg-right" || region === "leg-left") {
      return side ? [zoneKey(side, region)] : [];
    }
    return [];
  });
}

/** What a choice reads as in the card: the place, or what the piece does instead. */
export function choiceLabel(choice: string | undefined): string {
  if (!choice) return "Not placed";
  if (choice === "leave") return "Left out";
  if (choice === "flat") return "As it is, in front of the chest";
  if (choice.startsWith("on:")) return `On the ${choice.slice(3)}`;
  if (choice.startsWith("pair:"))
    return PAIRS[choice.slice(5) as Pair]?.label ?? choice;
  if (choice.startsWith("one:"))
    return PLACES[choice.slice(4) as Place]?.label ?? choice;
  return choice;
}
