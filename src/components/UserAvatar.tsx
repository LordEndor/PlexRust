import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { User } from "@/lib/api";

export function UserAvatar({ user, className }: { user: User; className?: string }) {
  const name = user.title || user.username;
  return (
    <Avatar className={className}>
      {user.thumb && <AvatarImage src={user.thumb} alt={name} />}
      <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
