import { SkeletonFrame, SkeletonTable, SkeletonToolbar } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading staff activity">
      <SkeletonToolbar chips={3} />
      <SkeletonTable rows={12} columns={4} title={false} />
    </SkeletonFrame>
  );
}
