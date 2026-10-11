import { SkeletonChart, SkeletonFrame, SkeletonKpis, SkeletonTable, SkeletonToolbar } from "../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading moderation overview">
      <SkeletonToolbar chips={3} />
      <SkeletonKpis count={4} />
      <SkeletonChart />
      <SkeletonTable rows={5} columns={4} />
    </SkeletonFrame>
  );
}
