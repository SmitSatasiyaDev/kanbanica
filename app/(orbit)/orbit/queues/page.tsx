import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
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
import { jobStateClass } from "@/lib/worker/job-descriptions";
import { getQueueSummary } from "@/lib/worker/queue-inspection";

export const metadata = {
  title: "Queues",
};

export default async function OrbitQueuesPage() {
  const queues = await getQueueSummary();

  return (
    <div>
      <OrbitPageHeader
        description="pg-boss queue state grouped by queue name and state. Start the worker to create the pgboss schema."
        eyebrow="Admin"
        title="Queues"
      />

      <Card>
        <CardHeader>
          <CardTitle>pg-boss</CardTitle>
          <CardDescription>
            Job queue states grouped by queue name. Click a queue to see its
            recent runs, errors and schedule.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>
                  <span className="sr-only">Details</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    No pg-boss rows yet. Run <code>pnpm worker</code> or enqueue
                    an email.
                  </TableCell>
                </TableRow>
              ) : (
                queues.map((queue) => (
                  <TableRow
                    className="group relative cursor-pointer"
                    key={`${queue.name}:${queue.state}`}
                  >
                    <TableCell>
                      {/* The link's ::after covers the whole row, so any cell opens the details. */}
                      <Link
                        className="font-medium outline-none after:absolute after:inset-0 group-hover:text-primary focus-visible:underline"
                        href={`/orbit/queues/${encodeURIComponent(queue.name)}`}
                      >
                        {queue.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={jobStateClass(queue.state)}>
                        {queue.state}
                      </Badge>
                    </TableCell>
                    <TableCell>{queue.count}</TableCell>
                    <TableCell className="w-8 text-right">
                      <CaretRightIcon className="inline size-3.5 text-base-content/40 transition-colors group-hover:text-base-content" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
