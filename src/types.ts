export interface Live2DMotionSpec {
  group?: string;
  index?: number;
  name?: string;
}

export interface Live2DAction {
  state: string;
  expression?: string;
  motion?: Live2DMotionSpec;
  bubble?: string;
  ts?: number;
  source?: string;
  eventType?: string;
  tool?: string;
}

export type ActionMap = Record<string, Omit<Live2DAction, 'state'>>;
