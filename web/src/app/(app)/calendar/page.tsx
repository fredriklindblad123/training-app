import { redirect } from "next/navigation";

export default async function CalendarIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string }>;
}) {
  const { athlete } = await searchParams;
  const now = new Date();
  const query = athlete ? `?athlete=${athlete}` : "";
  redirect(`/calendar/${now.getFullYear()}/${now.getMonth() + 1}${query}`);
}
