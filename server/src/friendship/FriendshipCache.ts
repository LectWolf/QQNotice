/**
 * In-memory `(botId, qq) → known` index. Pure module: no IO, no clock.
 * A separate persistence adapter writes through to the `Friendship` table
 * by observing calls into this cache.
 */
export class FriendshipCache {
  private byBot = new Map<number, Set<number>>();

  has(botId: number, qq: number): boolean {
    return this.byBot.get(botId)?.has(qq) ?? false;
  }

  findFriendlyBots(qq: number, aliveBotIds: number[]): number[] {
    const result: number[] = [];
    for (const botId of aliveBotIds) {
      if (this.byBot.get(botId)?.has(qq)) result.push(botId);
    }
    return result;
  }

  add(botId: number, qq: number): void {
    let set = this.byBot.get(botId);
    if (!set) {
      set = new Set();
      this.byBot.set(botId, set);
    }
    set.add(qq);
  }

  drop(botId: number, qq: number): void {
    this.byBot.get(botId)?.delete(qq);
  }

  replaceAllForBot(botId: number, qqs: number[]): void {
    this.byBot.set(botId, new Set(qqs));
  }

  /**
   * Returns a read-only view of the underlying `(botId -> qqSet)` map. Used
   * by BotManager to compute friendCount. Mutating the returned structure
   * is undefined behaviour; treat it as read-only.
   */
  snapshot(): Map<number, Set<number>> {
    return this.byBot;
  }
}
