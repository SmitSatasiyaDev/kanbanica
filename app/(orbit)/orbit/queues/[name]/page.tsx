import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrbitPageHeader } from "@/components/admin/orbit-page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { describeJob, jobStateClass } from "@/lib/worker/job-descriptions";
import {
  getQueueDetail,
  isJobState,
  QUEUE_DETAIL_JOB_LIMIT,
} from "@/lib/worker/queue-inspection";

interface Props {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ state?: string }>;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata({ params }: Props) {
  const { name } = await params;
  return { title: `${safeDecode(name)} · Queues` };
}

// Orbit is a platform-wide console and pg-boss crons run in UTC, so times are
// shown in UTC rather than whichever zone the server happens to run in.
function formatUtc(date: Date): string {
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date)} UTC`;
}

function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatSeconds(seconds: number | null): string {
  if (seconds == null) {
    return "—";
  }
  if (seconds % 86_400 === 0) {
    return `${seconds / 86_400} days`;
  }
  if (seconds % 3600 === 0) {
    return `${seconds / 3600} h`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60} min`;
  }
  return `${seconds} s`;
}

/** Plain-English reading of the cron shapes this app uses; raw cron otherwise. */
function describeCron(cron: string): string | null {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  if (dom !== "*" || mon !== "*" || dow !== "*") {
    return null;
  }
  const every = min?.match(/^\*\/(\d+)$/);
  if (every && hour === "*") {
    return `Every ${every[1]} minutes`;
  }
  if (/^\d+$/.test(min ?? "") && hour === "*") {
    return min === "0"
      ? "Every hour"
      : `Every hour at :${min.padStart(2, "0")}`;
  }
  if (/^\d+$/.test(min ?? "") && /^\d+$/.test(hour ?? "")) {
    return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return null;
}

function Stat({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium text-base-content/60 uppercase tracking-wide">
          {label}
        </p>
        <p className={cn("text-lg font-semibold", valueClassName)}>{value}</p>
        {hint && <p className="text-xs text-base-content/60">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default async function OrbitQueueDetailPage({
  params,
  searchParams,
}: Props) {
  const { name: rawName } = await params;
  const { state: rawState } = await searchParams;
  const name = safeDecode(rawName);
  const state = isJobState(rawState) ? rawState : undefined;

  const detail = await getQueueDetail(name, state);
  if (!detail) {
    notFound();
  }

  const total = detail.counts.reduce((sum, c) => sum + c.count, 0);
  const failed = detail.counts.find((c) => c.state === "failed")?.count ?? 0;
  const latestFinished = detail.jobs.find(
    (j) => j.state === "completed" || j.state === "failed"
  );
  // Health = how the most recent finished run ended. Only meaningful on the
  // unfiltered view, where `jobs` is the true latest runs.
  const health = state
    ? null
    : latestFinished?.state === "failed"
      ? { label: "Failing", className: "text-error" }
      : latestFinished
        ? { label: "Healthy", className: "text-success" }
        : { label: "No runs yet", className: "text-base-content/60" };
  const lastRun = state ? null : detail.jobs[0];
  const href = (s?: string) =>
    `/orbit/queues/${encodeURIComponent(name)}${s ? `?state=${s}` : ""}`;

  return (
    <div className="space-y-6">
      <Link
        className="inline-flex items-center gap-1.5 text-sm text-base-content/60 transition-colors hover:text-base-content"
        href="/orbit/queues"
      >
        <ArrowLeftIcon className="size-3.5" />
        All queues
      </Link>

      <OrbitPageHeader
        description={describeJob(name) ?? undefined}
        eyebrow="Queue"
        title={name}
      />

      {/* At a glance */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          hint={
            failed > 0
              ? `${failed} of ${total} kept runs failed`
              : `${total} kept runs`
          }
          label="Status"
          value={health?.label ?? "—"}
          valueClassName={health?.className}
        />
        <Stat
          hint={lastRun ? formatUtc(lastRun.createdOn) : undefined}
          label="Last run"
          value={
            lastRun
              ? formatDistanceToNow(lastRun.createdOn, { addSuffix: true })
              : "—"
          }
        />
        <Stat
          hint={
            detail.lastCompletedOn
              ? formatUtc(detail.lastCompletedOn)
              : undefined
          }
          label="Last success"
          value={
            detail.lastCompletedOn
              ? formatDistanceToNow(detail.lastCompletedOn, { addSuffix: true })
              : "Never (in kept history)"
          }
          valueClassName={detail.lastCompletedOn ? undefined : "text-error"}
        />
        <Stat
          hint={
            detail.schedules.length > 0
              ? detail.schedules
                  .map((s) => `${s.cron} (${s.timezone ?? "UTC"})`)
                  .join(", ")
              : "Enqueued by the app when needed"
          }
          label="Schedule"
          value={
            detail.schedules.length > 0
              ? (describeCron(detail.schedules[0].cron) ??
                detail.schedules[0].cron)
              : "On demand"
          }
        />
      </div>

      {/* Latest failure */}
      {detail.latestFailure && (
        <Card className="border-error/40">
          <CardHeader>
            <CardTitle className="text-error">Latest failure</CardTitle>
            <CardDescription>
              {formatUtc(detail.latestFailure.createdOn)} ·{" "}
              {formatDistanceToNow(detail.latestFailure.createdOn, {
                addSuffix: true,
              })}
              . The error pg-boss recorded for the most recent failed run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto rounded-md bg-base-200 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
              {detail.latestFailure.output}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
          <CardDescription>
            Newest {QUEUE_DETAIL_JOB_LIMIT} runs
            {state ? ` in state “${state}”` : ""}. pg-boss deletes finished runs
            after {formatSeconds(detail.settings?.deletionSeconds ?? null)}, so
            older history isn&apos;t available.
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link
              className={cn(
                "rounded-md border border-base-300 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-base-200",
                !state && "border-primary bg-primary/10 text-primary"
              )}
              href={href()}
            >
              All · {total}
            </Link>
            {detail.counts.map((c) => (
              <Link
                className={cn(
                  "rounded-md border border-base-300 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-base-200",
                  state === c.state &&
                    "border-primary bg-primary/10 text-primary"
                )}
                href={href(c.state)}
                key={c.state}
              >
                <span className={jobStateClass(c.state)}>{c.state}</span> ·{" "}
                {c.count}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Retries</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.jobs.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="py-8 text-center text-base-content/60"
                    colSpan={5}
                  >
                    No runs{state ? ` in state “${state}”` : ""}.
                  </TableCell>
                </TableRow>
              ) : (
                detail.jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="whitespace-nowrap">
                      <span title={job.id}>{formatUtc(job.createdOn)}</span>
                      <span className="block text-xs text-base-content/60">
                        {formatDistanceToNow(job.createdOn, {
                          addSuffix: true,
                        })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={jobStateClass(job.state)}>
                        {job.state}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {job.startedOn && job.completedOn
                        ? formatMs(
                            job.completedOn.getTime() - job.startedOn.getTime()
                          )
                        : "—"}
                    </TableCell>
                    <TableCell>{job.retryCount}</TableCell>
                    <TableCell className="min-w-64 max-w-xl">
                      {job.error ? (
                        <p
                          className="line-clamp-2 text-xs break-all whitespace-normal text-error"
                          title={job.error}
                        >
                          {job.error}
                        </p>
                      ) : (
                        <span className="text-base-content/60">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Settings */}
      {detail.settings && (
        <Card>
          <CardHeader>
            <CardTitle>Queue settings</CardTitle>
            <CardDescription>
              Set by <code>ensureJobQueues()</code> when the worker starts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Policy", detail.settings.policy ?? "—"],
                ["Retry limit", String(detail.settings.retryLimit ?? "—")],
                ["Retry delay", formatSeconds(detail.settings.retryDelay)],
                ["Expires after", formatSeconds(detail.settings.expireSeconds)],
                [
                  "Queued jobs kept",
                  formatSeconds(detail.settings.retentionSeconds),
                ],
                [
                  "Finished jobs kept",
                  formatSeconds(detail.settings.deletionSeconds),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-base-content/60">{label}</dt>
                  <dd className="mt-0.5 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
