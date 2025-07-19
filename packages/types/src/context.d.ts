import type { AttributeKey, AttributeValue } from "./attribute";

export interface Context {
  [key: AttributeKey]: AttributeValue;
}
