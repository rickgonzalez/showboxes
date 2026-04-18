'use client';

import { Viewer } from '@showboxes/player/Viewer';
import { useParams, useSearchParams } from 'next/navigation';
import '@showboxes/player/styles.css';

export default function ViewerPage() {
  const params = useParams<{ id: string }>();
  const token = useSearchParams().get('token');
  return <Viewer scriptId={params.id} token={token} />;
}
