"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addSpaceMember,
  changeSpaceMemberPermission,
  removeSpaceMember,
} from "@/app/actions/space";
import { UserAvatar } from "@/components/common/user-avatar";
import { MemberSearchInput } from "@/components/task/member-search-input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { filterMembersByQuery } from "@/lib/member-search";

type SpacePermission = "FULL_ACCESS" | "EDIT" | "VIEW";

interface WorkspaceMemberOption {
  email: string;
  name: string | null;
  userId: string;
}

interface SpaceMemberRow {
  id: string;
  permission: SpacePermission;
  user: {
    id: string;
    name: string | null;
    email: string;
    image?: string | null;
  };
  userId: string;
}

interface SpaceMembersManagerProps {
  members: SpaceMemberRow[];
  spaceId: string;
  workspaceId: string;
  workspaceMembers: WorkspaceMemberOption[];
}

const PERMISSION_LABELS: Record<SpacePermission, string> = {
  FULL_ACCESS: "Full Access",
  EDIT: "Edit",
  VIEW: "View",
};

export function SpaceMembersManager({
  workspaceId,
  spaceId,
  members,
  workspaceMembers,
}: SpaceMembersManagerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [memberSelectOpen, setMemberSelectOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const memberSearchRef = useRef<HTMLInputElement>(null);
  const [selectedPermission, setSelectedPermission] =
    useState<SpacePermission>("VIEW");

  const existingUserIds = new Set(members.map((m) => m.userId));
  const addableMembers = workspaceMembers.filter(
    (m) => !existingUserIds.has(m.userId)
  );

  // Fresh search each time the member list opens; focus the field once the
  // Select has finished moving focus to its first option.
  useEffect(() => {
    if (!memberSelectOpen) {
      setMemberSearch("");
      return;
    }
    const id = setTimeout(() => memberSearchRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [memberSelectOpen]);

  const filteredAddableMembers = filterMembersByQuery(
    addableMembers,
    memberSearch
  );

  function handleAdd() {
    if (!selectedUserId) {
      return;
    }
    startTransition(async () => {
      const result = await addSpaceMember(
        workspaceId,
        spaceId,
        selectedUserId,
        selectedPermission
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Member added");
      setAddOpen(false);
      setSelectedUserId("");
      setSelectedPermission("VIEW");
      router.refresh();
    });
  }

  function handleChangePermission(userId: string, permission: SpacePermission) {
    startTransition(async () => {
      const result = await changeSpaceMemberPermission(
        workspaceId,
        spaceId,
        userId,
        permission
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleRemove(userId: string) {
    startTransition(async () => {
      const result = await removeSpaceMember(workspaceId, spaceId, userId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Member removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-base-content/60">
          {members.length} member{members.length === 1 ? "" : "s"} with explicit
          access
        </p>

        <Dialog onOpenChange={setAddOpen} open={addOpen}>
          <DialogTrigger asChild>
            <Button disabled={addableMembers.length === 0} size="sm">
              Add member
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add member to Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Workspace member</Label>
                <Select
                  onOpenChange={setMemberSelectOpen}
                  onValueChange={setSelectedUserId}
                  open={memberSelectOpen}
                  value={selectedUserId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a member…" />
                  </SelectTrigger>
                  <SelectContent className="p-1.5">
                    <MemberSearchInput
                      autoFocus={false}
                      inputRef={memberSearchRef}
                      onChange={setMemberSearch}
                      // The Select swallows Space/Enter and type-to-navigate keys;
                      // keep them in the field. Arrows still hand off to the list.
                      onKeyDown={(e) => {
                        if (
                          e.key !== "ArrowDown" &&
                          e.key !== "ArrowUp" &&
                          e.key !== "Escape" &&
                          e.key !== "Tab"
                        ) {
                          e.stopPropagation();
                        }
                      }}
                      value={memberSearch}
                    />
                    <div className="max-h-60 overflow-y-auto">
                      {filteredAddableMembers.length === 0 && (
                        <p className="px-3 py-2 text-base-content/60 text-xs">
                          No members found
                        </p>
                      )}
                      {filteredAddableMembers.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="shrink-0">
                              {m.name?.trim() || m.email}
                            </span>
                            {m.name?.trim() && (
                              <span className="truncate text-base-content/60 text-xs">
                                {m.email}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </div>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Permission</Label>
                <Select
                  onValueChange={(v) =>
                    setSelectedPermission(v as SpacePermission)
                  }
                  value={selectedPermission}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="p-1.5">
                    {(Object.keys(PERMISSION_LABELS) as SpacePermission[]).map(
                      (p) => (
                        <SelectItem key={p} value={p}>
                          {PERMISSION_LABELS[p]}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  disabled={pending}
                  onClick={() => setAddOpen(false)}
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  className="gap-2"
                  disabled={pending || !selectedUserId}
                  onClick={handleAdd}
                >
                  {pending && <Spinner className="size-4" />}
                  Add
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-base-content/60 py-6 text-center">
          No explicit members yet. Public Projects are visible to all workspace
          members with View access.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {members.map((member) => (
            <div
              className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap"
              key={member.id}
            >
              <UserAvatar
                email={member.user.email}
                image={member.user.image}
                name={member.user.name}
                size="md"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {member.user.name?.trim() || member.user.email}
                </p>
                {member.user.name && (
                  <p className="text-xs text-base-content/60 truncate">
                    {member.user.email}
                  </p>
                )}
              </div>

              <div className="flex basis-full items-center justify-end gap-2 sm:basis-auto sm:justify-start">
                <Select
                  disabled={pending}
                  onValueChange={(v) =>
                    handleChangePermission(member.userId, v as SpacePermission)
                  }
                  value={member.permission}
                >
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="p-1.5">
                    {(Object.keys(PERMISSION_LABELS) as SpacePermission[]).map(
                      (p) => (
                        <SelectItem className="text-xs" key={p} value={p}>
                          {PERMISSION_LABELS[p]}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      className="text-error hover:text-error"
                      disabled={pending}
                      size="sm"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove member?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {member.user.name?.trim() || member.user.email} will
                        lose explicit access to this Project. They remain a
                        workspace member.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-error text-error-content hover:bg-error/90"
                        onClick={() => handleRemove(member.userId)}
                      >
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
