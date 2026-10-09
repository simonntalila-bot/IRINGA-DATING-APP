import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * Block / hide policy, used by discovery, chat and notifications so nobody
 * re-implements "can these two users see each other" incorrectly.
 *
 * A block hides BOTH directions: the blocker disappears from the blocked
 * user's discovery and the blocker can no longer message, match or receive
 * location information about them.
 */
export interface BlockMap {
  blockedByViewer: Set<string>;
  blockedViewer: Set<string>;
  hiddenByViewer: Set<string>;
}

export const buildBlockMap = (input: {
  blockedByViewer: Array<{ blockedId: string }>;
  blockedViewer: Array<{ blockerId: string }>;
  hidden?: Array<{ targetId: string }>;
}): BlockMap => ({
  blockedByViewer: new Set(input.blockedByViewer.map((b) => b.blockedId)),
  blockedViewer: new Set(input.blockedViewer.map((b) => b.blockerId)),
  hiddenByViewer: new Set((input.hidden ?? []).map((h) => h.targetId)),
});

export const isBlockedEitherWay = (map: BlockMap, otherUserId: string): boolean =>
  map.blockedByViewer.has(otherUserId) || map.blockedViewer.has(otherUserId);

/** Throw when the viewer is not allowed to see this user at all. */
export function assertNotBlocked(map: BlockMap, otherUserId: string): void {
  if (map.blockedByViewer.has(otherUserId)) {
    throw new NotFoundException('Profile not found');
  }
  if (map.blockedViewer.has(otherUserId)) {
    throw new ForbiddenException('You can no longer access this profile');
  }
}

/** Filter ids that must not appear in any result set (used by discovery). */
export const excludeIds = (map: BlockMap, ids: string[]): string[] =>
  ids.filter((id) => !map.blockedByViewer.has(id) && !map.blockedViewer.has(id) && !map.hiddenByViewer.has(id));
