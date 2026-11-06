import { IsBoolean } from 'class-validator';

/**
 * Body for `POST /service-sessions/:id/checklist/tasks/:taskId`.
 *
 * `{ done }` — toggle the task's completion. The Cleaner is authorized server-side; the count
 * invariant is maintained under the run lock.
 */
export class MarkTaskDto {
  @IsBoolean()
  readonly done!: boolean;
}
