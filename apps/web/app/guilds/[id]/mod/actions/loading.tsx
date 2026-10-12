import { SkeletonFrame, SkeletonTable, SkeletonToolbar } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading member actions">
      <SkeletonToolbar chips={5} />
      <SkeletonTable rows={12} columns={6} title={false} />
    </SkeletonFrame>
  );
}
