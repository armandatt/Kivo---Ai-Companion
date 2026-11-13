// A finished session as Progress lists it (focus-history.ts). No imports: the
// web app reads this type.
export interface RecentSession {
  id: string;
  startedAt: string;
  minutes: number;
  title: string;
  kind: "topic" | "focus";
  subjectName: string | null;
  category: string | null;
  description: string | null;
  counted: boolean;
}
