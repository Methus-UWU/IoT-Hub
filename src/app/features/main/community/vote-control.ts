import { Component, computed, input, output } from '@angular/core';

import { VoteValue } from '../../../core/services/community-api.service';

/**
 * The up/down score control used by both posts and answers.
 *
 * Pressing the arrow you already chose withdraws the vote, which is what every
 * feed does and what the API's `0` means. The component owns none of that state:
 * it emits the value the caller should send and re-renders from what comes back,
 * so an optimistic update that the server rejects cannot leave the arrow lit.
 */
@Component({
  selector: 'app-vote-control',
  templateUrl: './vote-control.html',
  styleUrl: './vote-control.css',
})
export class VoteControl {
  readonly score = input.required<number>();
  readonly viewerVote = input<VoteValue>(0);
  readonly orientation = input<'vertical' | 'horizontal'>('vertical');
  /** Signed-out visitors see the control but are sent to sign in when they press. */
  readonly canVote = input(true);
  readonly busy = input(false);
  readonly label = input('โหวต');

  readonly vote = output<VoteValue>();

  protected readonly upActive = computed(() => this.viewerVote() === 1);
  protected readonly downActive = computed(() => this.viewerVote() === -1);

  protected press(direction: 1 | -1): void {
    this.vote.emit(this.viewerVote() === direction ? 0 : direction);
  }
}
