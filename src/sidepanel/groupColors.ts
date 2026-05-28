import type { TabGroupColor } from "../models/workspace.model";

export const GROUP_COLORS: TabGroupColor[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

const GROUP_COLOR_STYLES: Record<TabGroupColor, Record<string, string>> = {
  grey: {
    "--group-color": "#5f6368",
    "--group-bg": "#f1f3f4",
    "--group-bg-dark": "#2f3337",
  },
  blue: {
    "--group-color": "#1a73e8",
    "--group-bg": "#e8f0fe",
    "--group-bg-dark": "#1f2f46",
  },
  red: {
    "--group-color": "#d93025",
    "--group-bg": "#fce8e6",
    "--group-bg-dark": "#442522",
  },
  yellow: {
    "--group-color": "#f9ab00",
    "--group-bg": "#fef7e0",
    "--group-bg-dark": "#443416",
  },
  green: {
    "--group-color": "#188038",
    "--group-bg": "#e6f4ea",
    "--group-bg-dark": "#1d3b28",
  },
  pink: {
    "--group-color": "#d01884",
    "--group-bg": "#fde7f3",
    "--group-bg-dark": "#46263a",
  },
  purple: {
    "--group-color": "#9334e6",
    "--group-bg": "#f3e8fd",
    "--group-bg-dark": "#362548",
  },
  cyan: {
    "--group-color": "#007b83",
    "--group-bg": "#e4f7fb",
    "--group-bg-dark": "#173d42",
  },
  orange: {
    "--group-color": "#fa7b17",
    "--group-bg": "#feefe3",
    "--group-bg-dark": "#4a2e1a",
  },
};

export function groupColorStyle(color: TabGroupColor) {
  return GROUP_COLOR_STYLES[color];
}
