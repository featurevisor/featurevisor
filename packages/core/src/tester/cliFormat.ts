export const CLI_FORMAT_RED = "\x1b[31m%s\x1b[0m";
export const CLI_FORMAT_GREEN = "\x1b[32m%s\x1b[0m";
export const CLI_FORMAT_YELLOW = "\x1b[33m%s\x1b[0m";
export const CLI_FORMAT_CYAN = "\x1b[36m%s\x1b[0m";
export const CLI_FORMAT_DIM = "\x1b[2m%s\x1b[0m";

export const CLI_COLOR_RED = 31;
export const CLI_COLOR_GREEN = 32;
export const CLI_COLOR_YELLOW = 33;
export const CLI_COLOR_CYAN = 36;
export const CLI_COLOR_DIM = 2;

export const CLI_FORMAT_BOLD = "\x1b[1m%s\x1b[0m";
export const CLI_FORMAT_UNDERLINE = "\x1b[4m%s\x1b[0m";
export const CLI_FORMAT_BOLD_UNDERLINE = "\x1b[1m\x1b[4m%s\x1b[0m";

export function colorize(value: string | number | boolean, colorCode: number) {
  return `\x1b[${colorCode}m${value}\x1b[0m`;
}
