'use client';

import { Card, CardContent, CardHeader, CardTitle, Button } from '@ssd-studio/ui';
import Link from 'next/link';

interface Service {
  id: string;
  title: string;
  description: string;
  price: string;
  icon: string;
}

const SERVICES: Service[] = [
  {
    id: 'portrait',
    title: 'Portrait Session',
    description: 'Professional headshots and personal portraits in studio or on-location.',
    price: 'From $250',
    icon: '📸',
  },
  {
    id: 'commercial',
    title: 'Commercial Shoot',
    description: 'High-quality imagery for brands, marketing campaigns, and advertising.',
    price: 'From $800',
    icon: '🎬',
  },
  {
    id: 'event',
    title: 'Event Coverage',
    description: 'Full event photography and videography — corporate, weddings, and more.',
    price: 'From $500',
    icon: '🎉',
  },
  {
    id: 'brand',
    title: 'Brand Campaign',
    description: 'End-to-end visual storytelling for brand launches and campaigns.',
    price: 'From $1,500',
    icon: '✨',
  },
  {
    id: 'product',
    title: 'Product Photography',
    description: 'Clean, detailed product shots for e-commerce and catalogs.',
    price: 'From $400',
    icon: '📦',
  },
  {
    id: 'video',
    title: 'Video Production',
    description: 'Short films, promotional videos, and social media content.',
    price: 'From $1,200',
    icon: '🎥',
  },
];

export default function ServiceGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {SERVICES.map((service) => (
        <Card key={service.id} className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="text-3xl mb-2">{service.icon}</div>
            <CardTitle>{service.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">{service.description}</p>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{service.price}</span>
              <Link href="/booking">
                <Button size="sm" variant="outline">
                  Book Now
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
