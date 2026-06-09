'use client';

import { Card, CardContent, CardHeader, CardTitle, Badge } from '@ssd-studio/ui';

interface MediaItem {
  id: string;
  fileName?: string | null;
  mimeType?: string | null;
  deliveryStatus: string;
  thumbnailUrl?: string;
}

const SAMPLE_MEDIA: MediaItem[] = [
  { id: '1', fileName: 'portrait-001.jpg', mimeType: 'image/jpeg', deliveryStatus: 'DELIVERED', thumbnailUrl: '' },
  { id: '2', fileName: 'commercial-001.jpg', mimeType: 'image/jpeg', deliveryStatus: 'URL_GENERATED', thumbnailUrl: '' },
  { id: '3', fileName: 'event-001.mp4', mimeType: 'video/mp4', deliveryStatus: 'PENDING', thumbnailUrl: '' },
];

function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'DELIVERED': return 'default';
    case 'URL_GENERATED': return 'outline';
    case 'PENDING': return 'secondary';
    default: return 'outline';
  }
}

export default function MediaGallery() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Media Gallery</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SAMPLE_MEDIA.map((item) => (
          <Card key={item.id}>
            <CardHeader className="pb-2">
              <div className="aspect-video bg-muted rounded-md flex items-center justify-center mb-2">
                {item.mimeType?.startsWith('video/') ? (
                  <span className="text-3xl">🎬</span>
                ) : (
                  <span className="text-3xl">🖼️</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm truncate">{item.fileName}</CardTitle>
                <Badge variant={getStatusVariant(item.deliveryStatus)} className="ml-2 shrink-0">
                  {item.deliveryStatus}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {item.mimeType && (
                <p className="text-xs text-muted-foreground">{item.mimeType}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
