import { SkeletonFrame, SkeletonTable, SkeletonToolbar } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading the action log">
      <SkeletonToolbar chips={5} />
      <SkeletonTable rows={12} columns={6} title={false} />
    </SkeletonFrame>
  );
}
