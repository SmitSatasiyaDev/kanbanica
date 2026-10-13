import { count, desc } from "drizzle-orm";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { emailEvents, emailOutbox } from "@/db/schema";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export const metadata = {
  title: "Email",
};

function outboxStatusClass(status: string): string {
  switch (status) {
    case "sent":
      return "text-success";
    case "failed":
      return "text-error";
    default:
      return "text-warning";
  }
}

export default async function OrbitEmailPage() {
  const [outbox, events, [outboxTotal], [eventsTotal]] = await Promise.all([
    db
      .select()
      .from(emailOutbox)
      .orderBy(desc(emailOutbox.createdAt))
      .limit(50),
    db
      .select()
      .from(emailEvents)
      .orderBy(desc(emailEvents.receivedAt))
      .limit(50),
    db.select({ count: count() }).from(emailOutbox),
    db.select({ count: count() }).from(emailEvents),
  ]);

  return (
    <div>
      <OrbitPageHeader
        description="Transactional email queue and inbound delivery events."
        eyebrow="Admin"
        title="Email"
      />

      {/* Tabs, not side by side (the outbox needs the full width for all its
          columns) and not stacked (Events would sit below 50 outbox rows,
          out of sight). The tab labels carry the totals so both are visible. */}
      <Tabs className="gap-4" defaultValue="outbox">
        <TabsList>
          <TabsTrigger className="cursor-pointer" value="outbox">
            Outbox · {outboxTotal.count}
          </TabsTrigger>
          <TabsTrigger className="cursor-pointer" value="events">
            Events · {eventsTotal.count}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="outbox">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Outbox</CardTitle>
              <CardDescription>
                Queued and delivered transactional emails —{" "}
                {outboxTotal.count > outbox.length
                  ? `newest ${outbox.length} of ${outboxTotal.count}`
                  : `${outboxTotal.count} total`}
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="min-w-[44rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outbox.length === 0 ? (
                    <TableRow>
                      <TableCell
                        className="py-8 text-center text-base-content/60"
                        colSpan={5}
                      >
                        No emails yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    outbox.map((email) => (
                      <TableRow key={email.id}>
                        <TableCell className="max-w-64">
                          <span
                            className="block truncate"
                            title={email.payload.to}
                          >
                            {email.payload.to}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-96">
                          <span
                            className="block truncate"
                            title={email.payload.subject}
                          >
                            {email.payload.subject}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={outboxStatusClass(email.status)}
                            title={email.lastError ?? undefined}
                          >
                            {email.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {email.attemptCount} / {email.maxAttempts}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-base-content/60">
                          {formatDateTime(email.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Events</CardTitle>
              <CardDescription>
                Inbound webhook events from your SMTP provider —{" "}
                {eventsTotal.count > events.length
                  ? `newest ${events.length} of ${eventsTotal.count}`
                  : `${eventsTotal.count} total`}
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="min-w-[32rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.length === 0 ? (
                    <TableRow>
                      <TableCell
                        className="py-8 text-center text-base-content/60"
                        colSpan={3}
                      >
                        No delivery events received yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    events.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="whitespace-nowrap">
                          {event.eventType}
                        </TableCell>
                        <TableCell className="max-w-64">
                          <span
                            className="block truncate"
                            title={event.recipient ?? undefined}
                          >
                            {event.recipient ?? "-"}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-base-content/60">
                          {formatDateTime(event.receivedAt)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
