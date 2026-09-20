import MyPage from "../page";
import { AllProjectsToggle } from "@/components/AllProjectsToggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects · Green Bergen" };

// EVERY PROJECT, ON ITS OWN PAGE (Shahar, 2026-09-20: "a link to all projects
// (same logic as listed here on the page, just a different page)").
//
// show="projects" paints the project rails - the loose jobs, the umbrella and
// ventures - and leaves the houses to /my/houses. The work filters and the
// closed-projects toggle come with it, because they are part of the same
// component rather than something this page re-implements.
export default function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; error?: string; ok?: string; t?: string; all?: string; allp?: string; view?: string }>;
}) {
  // The switch between "my seats" and "the whole platform" sits ON the list it
  // changes now, not behind the gear two screens away (Shahar, 2026-09-20:
  // "remove all projects from under the setup tab / they should be kept in
  // the project page"). Renders nothing for anyone but a superadmin.
  return (
    <>
      <AllProjectsToggle back="/my/projects" />
      {MyPage({ searchParams, show: "projects" })}
    </>
  );
}
