'use client';

import { useState } from 'react';
import EnquiryModal from '@/components/web-services/EnquiryModal';
import { ArrowIcon } from '@/components/public/primitives';
import { Badge } from '@/components/ui/semantic';
import { DEPLOYMENTS } from './content';
import styles from './web-systems.module.css';

// The only interactive part of /web-systems: each deployment option opens
// the enquiry modal (same component, same open/close state as before).
export function DeploymentOptions() {
  const [enquiryOpen, setEnquiryOpen] = useState(false);

  return (
    <>
      <ul className={`bb-cells ${styles.deployGrid}`}>
        {DEPLOYMENTS.map(deployment => (
          <li
            key={deployment.title}
            className={`${styles.deployCard} ${deployment.featured ? styles.deployFeatured : ''}`}
          >
            <div className={styles.deployMeta}>
              <p className="bb-eyebrow">{deployment.label}</p>
              {deployment.featured && <Badge state="active">Recommended</Badge>}
            </div>
            <h3 className={styles.deployTitle}>{deployment.title}</h3>
            <p className={styles.cellBody}>{deployment.description}</p>
            <ul className={styles.includes}>
              {deployment.includes.map(item => (
                <li key={item}>
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                    className={styles.check}
                  >
                    <path d="m3.5 8.5 3 3 6-7" />
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={deployment.featured ? styles.deployButtonPrimary : styles.deployButton}
              onClick={() => setEnquiryOpen(true)}
            >
              {deployment.action}
              <ArrowIcon className={styles.arrow} />
            </button>
          </li>
        ))}
      </ul>

      <EnquiryModal open={enquiryOpen} onClose={() => setEnquiryOpen(false)} />
    </>
  );
}
