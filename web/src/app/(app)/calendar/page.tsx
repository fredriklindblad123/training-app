import { redirect } from "next/navigation";

export default function CalendarIndexPage() {
  const now = new Date();
  redirect(`/calendar/${now.getFullYear()}/${now.getMonth() + 1}`);
}
