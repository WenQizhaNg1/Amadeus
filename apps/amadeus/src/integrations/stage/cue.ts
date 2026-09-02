/** A high-level presentation hint. Stage owns the concrete model mapping. */
export interface Cue {
  emotion?: string;
  motion?: string;
  gaze?: 'user' | 'away' | 'screen';
}
