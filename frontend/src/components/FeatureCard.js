import React from 'react';

export default function FeatureCard({ icon: Icon, title, subtitle, onClick, badge }) {
  return (
    <div
      onClick={onClick}
      className="
        group relative bg-white rounded-lg p-6 shadow-sm border border-gray-200
        hover:shadow-lg hover:scale-105 hover:border-purple-200
        transition-all duration-200 cursor-pointer
      "
    >
      {badge && (
        <div className="absolute top-4 right-4">
          <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-600 rounded-full">
            {badge}
          </span>
        </div>
      )}
      
      <div className="flex items-start space-x-4">
        {Icon && (
          <div className="flex-shrink-0 w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
            <Icon className="text-purple-600" size={24} />
          </div>
        )}
        
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 mb-1 group-hover:text-purple-600 transition-colors">
            {title}
          </h3>
          {subtitle && (
            <p className="text-sm text-gray-600 leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
