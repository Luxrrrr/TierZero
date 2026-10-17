import { SkeletonFrame, SkeletonTable, SkeletonToolbar } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading the ticket settings">
      <SkeletonToolbar chips={0} />
      <SkeletonTable rows={6} columns={2} />
    </SkeletonFrame>
  );
}
