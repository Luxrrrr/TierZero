import { SkeletonChart, SkeletonFrame, SkeletonKpis, SkeletonTable, SkeletonToolbar } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading ticket statistics">
      <SkeletonToolbar chips={3} />
      <SkeletonKpis count={6} />
      <SkeletonChart />
      <SkeletonTable rows={4} columns={6} />
    </SkeletonFrame>
  );
}
