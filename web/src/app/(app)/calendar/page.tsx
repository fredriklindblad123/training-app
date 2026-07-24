import { redirect } from "next/navigation";

export default function CalendarIndexPage() {
  redirect(`/calendar/${new Date().getFullYear()}`);
}
